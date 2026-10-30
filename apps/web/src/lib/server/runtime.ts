import "server-only";
import {
  AccountService,
  PlanService,
  AuthenticationService,
  MessagingService,
  FriendshipService,
  GroupService,
  PrivacyService,
} from "@merkat/backend";
import {
  createDatabase,
  createAccountRepository,
  createPlanRepository,
  createCredentialRepository,
  createAuthenticationLimiter,
  createMessagingRepository,
  createFriendshipRepository,
  createGroupRepository,
  createPrivacyRepository,
  createProfileRepository,
  createCalendarRepository,
  createTabRepository,
  createSecurityRepository,
  createPushRepository,
} from "@merkat/database";
import { authenticationSecret } from "./authentication-environment";

function createServices() {
  const database = createDatabase(process.env);
  const accounts = new AccountService(createAccountRepository(database));
  let authentication: AuthenticationService | undefined;
  let security: ReturnType<typeof createSecurityRepository> | undefined;
  return {
    database,
    profiles: createProfileRepository(database),
    calendar: createCalendarRepository(database),
    tabs: createTabRepository(database),
    security: () => (security ??= createSecurityRepository(database)),
    push: createPushRepository(database),
    accounts,
    plans: new PlanService(accounts, createPlanRepository(database)),
    messaging: new MessagingService(createMessagingRepository(database)),
    friendships: new FriendshipService(createFriendshipRepository(database)),
    groups: new GroupService(createGroupRepository(database)),
    privacy: new PrivacyService(createPrivacyRepository(database)),
    authentication() {
      return (authentication ??= new AuthenticationService(
        createCredentialRepository(database),
        createAuthenticationLimiter(database),
        authenticationSecret(process.env),
      ));
    },
  };
}
export type Services = ReturnType<typeof createServices>;
// One bounded pool per warm process, also surviving development hot reloads.
const runtime = globalThis as typeof globalThis & { merkatServices?: Services };
export function getServices(): Services {
  return (runtime.merkatServices ??= createServices());
}
