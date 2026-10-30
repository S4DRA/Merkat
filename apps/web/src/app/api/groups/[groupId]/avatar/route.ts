import {handleGroupAvatar} from "../../../../../lib/server/group-avatar-api";
export const runtime="nodejs";
type Context={params:Promise<{groupId:string}>};
const handle=async(request:Request,context:Context)=>handleGroupAvatar(request,(await context.params).groupId);
export const GET=handle;
export const PUT=handle;
export const DELETE=handle;
