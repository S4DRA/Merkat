import {
  privacySettingsSchema,
  blockUserSchema,
  blockedListSchema,
  safetyReportSchema,
  type PrivacySettings,
  type BlockUserInput,
  type BlockedListInput,
  type BlockedList,
  type SafetyReportInput,
} from "@merkat/contracts";
import { socialInput, socialSessionHash } from "./social.js";
export interface PrivacyRepository {
  settings(hash: string): Promise<PrivacySettings>;
  update(hash: string, input: PrivacySettings): Promise<PrivacySettings>;
  blocks(hash: string, input: BlockedListInput): Promise<BlockedList>;
  block(hash: string, input: BlockUserInput): Promise<void>;
  report(hash: string, input: SafetyReportInput): Promise<void>;
}
export class PrivacyService {
  constructor(private readonly repository: PrivacyRepository) {}
  async settings(token: string | undefined) {
    return this.repository.settings(socialSessionHash(token));
  }
  async update(token: string | undefined, input: unknown) {
    return this.repository.update(
      socialSessionHash(token),
      socialInput(privacySettingsSchema, input),
    );
  }
  async blocks(token: string | undefined, input: unknown) {
    return this.repository.blocks(
      socialSessionHash(token),
      socialInput(blockedListSchema, input),
    );
  }
  async block(token: string | undefined, input: unknown) {
    return this.repository.block(
      socialSessionHash(token),
      socialInput(blockUserSchema, input),
    );
  }
  async report(token: string | undefined, input: unknown) {
    return this.repository.report(
      socialSessionHash(token),
      socialInput(safetyReportSchema, input),
    );
  }
}
