import { Prisma, type PrismaClient } from "./generated/client.js";

// Check the schema the running application actually queries. Migration history
// alone is insufficient: the restricted server role cannot read it, and new
// tables also need the separately reviewed Supabase runtime grants/RLS policies.
const groupTables = [
  "ChatGroup",
  "GroupMember",
  "GroupChannel",
  "GroupMessage",
  "GroupReadState",
  "GroupInvitation",
  "UserPrivacy",
  "UserBlock",
  "SafetyReport",
];

export async function checkRuntimeDatabase(db: PrismaClient) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const [role] = await tx.$queryRaw<
      {
        restricted: boolean;
      }[]
    >`SELECT NOT (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole)
      AS restricted FROM pg_roles WHERE rolname = current_user`;
    // The inspected schema uses no @map/@@map; generated scalar enums therefore
    // match SQL names and include new models/columns without a second inventory.
    const required = Object.values(Prisma.ModelName).map((table) => ({
      table,
      columns: Object.values(Prisma[`${table}ScalarFieldEnum`]),
    }));
    const tables = await tx.$queryRaw<
      {
        table: string;
        exists: boolean;
        rls: boolean;
        owned: boolean;
        missingColumns: string[];
        missingPrivileges: string[];
        runtimePolicy: boolean;
      }[]
    >`
      SELECT required->>'table' AS "table", c.oid IS NOT NULL AS exists,
        COALESCE(c.relrowsecurity, false) AS rls,
        COALESCE(c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user), false) AS owned,
        ARRAY(SELECT col FROM jsonb_array_elements_text(required->'columns') col
          WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid
            AND a.attname = col AND a.attnum > 0 AND NOT a.attisdropped)) AS "missingColumns",
        ARRAY(SELECT privilege FROM unnest(CASE WHEN required->>'table' = 'SafetyReport'
          THEN ARRAY['INSERT'] ELSE ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] END) privilege
          WHERE c.oid IS NULL OR NOT has_table_privilege(c.oid, privilege)) AS "missingPrivileges",
        EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid
          AND p.polname = CASE WHEN required->>'table' = 'SafetyReport'
            THEN 'merkat_report_insert' ELSE 'merkat_server' END
          AND p.polcmd = CASE WHEN required->>'table' = 'SafetyReport' THEN 'a' ELSE '*' END
          AND EXISTS (SELECT 1 FROM unnest(p.polroles) policy_role
            WHERE policy_role = 0 OR pg_has_role(policy_role, 'USAGE'))) AS "runtimePolicy"
      FROM jsonb_array_elements(${JSON.stringify(required)}::jsonb) required
      LEFT JOIN pg_namespace n ON n.nspname = 'public'
      LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = required->>'table'
        AND c.relkind = 'r'
      ORDER BY required->>'table'
    `;
    const issues: string[] = [];
    if (!role?.restricted)
      issues.push(
        "Use the restricted application DATABASE_URL, not the migration owner.",
      );
    for (const table of tables) {
      if (!table.exists) {
        issues.push(`Missing table: ${table.table}`);
        continue;
      }
      if (table.missingColumns.length)
        issues.push(
          `Missing columns: ${table.table}.${table.missingColumns.join(", ")}`,
        );
      if (table.missingPrivileges.length)
        issues.push(
          `Missing runtime privileges: ${table.table} (${table.missingPrivileges.join(", ")})`,
        );
      if (!table.rls) issues.push(`RLS disabled: ${table.table}`);
      if (table.owned)
        issues.push(`Application role owns table: ${table.table}`);
      if (!table.runtimePolicy)
        issues.push(`Missing runtime RLS policy: ${table.table}`);
    }
    // The insert-only report boundary must remain intact after setup.
    const [reportAccess] = await tx.$queryRaw<{ readable: boolean }[]>`
      SELECT COALESCE(has_table_privilege(to_regclass('public."SafetyReport"'), 'SELECT'), false) AS readable
    `;
    if (reportAccess?.readable)
      issues.push("Application role can read private safety reports.");
    const missingGroupSchema = tables.some(
      (table) =>
        (groupTables.includes(table.table) && !table.exists) ||
        table.missingColumns.length > 0,
    );
    return { ready: issues.length === 0, missingGroupSchema, issues };
  });
}
