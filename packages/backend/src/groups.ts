import {
  groupIdSchema,
  groupCreateSchema,
  groupListSchema,
  groupEditSchema,
  groupInviteSchema,
  groupMemberActionSchema,
  groupInvitationActionSchema,
  channelCreateSchema,
  channelEditSchema,
  groupMessagePageSchema,
  groupSendSchema,
  groupReceiptSchema,
  type GroupDetail,
  type GroupList,
  type GroupCreateInput,
  type GroupListInput,
  type GroupEditInput,
  type GroupInviteInput,
  type GroupMemberActionInput,
  type GroupInvitationActionInput,
  type ChannelCreateInput,
  type ChannelEditInput,
  type GroupMessagePageInput,
  type GroupSendInput,
  type GroupReceiptInput,
  type GroupMessagePage,
  type GroupMessageView,
} from "@merkat/contracts";
import { socialInput, socialSessionHash } from "./social.js";
export interface GroupRepository {
  list(hash: string, input: GroupListInput): Promise<GroupList>;
  create(hash: string, input: GroupCreateInput): Promise<GroupDetail>;
  detail(hash: string, groupId: string): Promise<GroupDetail>;
  edit(hash: string, input: GroupEditInput): Promise<GroupDetail>;
  invite(hash: string, input: GroupInviteInput): Promise<void>;
  invitation(hash: string, input: GroupInvitationActionInput): Promise<void>;
  member(hash: string, input: GroupMemberActionInput): Promise<GroupDetail>;
  leave(hash: string, groupId: string): Promise<void>;
  createChannel(hash: string, input: ChannelCreateInput): Promise<GroupDetail>;
  editChannel(hash: string, input: ChannelEditInput): Promise<GroupDetail>;
  messages(
    hash: string,
    input: GroupMessagePageInput,
  ): Promise<GroupMessagePage>;
  send(hash: string, input: GroupSendInput): Promise<GroupMessageView>;
  receipt(hash: string, input: GroupReceiptInput): Promise<GroupDetail>;
}
export class GroupService {
  constructor(private readonly repository: GroupRepository) {}
  async list(token: string | undefined, input: unknown) {
    return this.repository.list(
      socialSessionHash(token),
      socialInput(groupListSchema, input),
    );
  }
  async create(token: string | undefined, input: unknown) {
    return this.repository.create(
      socialSessionHash(token),
      socialInput(groupCreateSchema, input),
    );
  }
  async detail(token: string | undefined, input: unknown) {
    return this.repository.detail(
      socialSessionHash(token),
      socialInput(groupIdSchema, input).groupId,
    );
  }
  async edit(token: string | undefined, input: unknown) {
    return this.repository.edit(
      socialSessionHash(token),
      socialInput(groupEditSchema, input),
    );
  }
  async invite(token: string | undefined, input: unknown) {
    return this.repository.invite(
      socialSessionHash(token),
      socialInput(groupInviteSchema, input),
    );
  }
  async invitation(token: string | undefined, input: unknown) {
    return this.repository.invitation(
      socialSessionHash(token),
      socialInput(groupInvitationActionSchema, input),
    );
  }
  async member(token: string | undefined, input: unknown) {
    return this.repository.member(
      socialSessionHash(token),
      socialInput(groupMemberActionSchema, input),
    );
  }
  async leave(token: string | undefined, input: unknown) {
    return this.repository.leave(
      socialSessionHash(token),
      socialInput(groupIdSchema, input).groupId,
    );
  }
  async createChannel(token: string | undefined, input: unknown) {
    return this.repository.createChannel(
      socialSessionHash(token),
      socialInput(channelCreateSchema, input),
    );
  }
  async editChannel(token: string | undefined, input: unknown) {
    return this.repository.editChannel(
      socialSessionHash(token),
      socialInput(channelEditSchema, input),
    );
  }
  async messages(token: string | undefined, input: unknown) {
    return this.repository.messages(
      socialSessionHash(token),
      socialInput(groupMessagePageSchema, input),
    );
  }
  async send(token: string | undefined, input: unknown) {
    return this.repository.send(
      socialSessionHash(token),
      socialInput(groupSendSchema, input),
    );
  }
  async receipt(token: string | undefined, input: unknown) {
    return this.repository.receipt(
      socialSessionHash(token),
      socialInput(groupReceiptSchema, input),
    );
  }
}
