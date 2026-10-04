/** Public API contract. Permissions are enforced independently by the Worker. */
export const PLATFORM_PERMISSIONS = ['users.read','users.edit','users.ban','users.stats','users.telemetry','users.permissions','users.admin_permissions','teams.invitations.read','teams.invitations.write','teams.create','teams.manage','settings.edit','audit.read'] as const;
export type PlatformPermission = typeof PLATFORM_PERMISSIONS[number];
export const TEAM_PERMISSIONS = ['team.edit','members.invite','invitations.read','invitations.write','members.manage','members.stats','assignments.edit','permissions.manage','leaderboard.manage'] as const;
export type TeamPermission = typeof TEAM_PERMISSIONS[number];
export interface CloudStats { sessions:number; completed:number; attempts:number; questions:number; earned:number; possible:number; accuracy:number; activeDays:number; lastPracticeAt:string|null; selfAssessed:number; adjustedXP:number; xp:number; independentEarned?:number; independentPossible?:number; guidedEarned?:number; guidedPossible?:number }
export interface CloudUser { id:string; username:string; displayName:string; createdAt:string; lastSeenAt:string; banned:boolean; banReason:string|null; permissions:PlatformPermission[]; shareStats:boolean; isOwner?:boolean }
export interface CloudBootstrap { guestAllowed:boolean; authConfigured:boolean; user:CloudUser|null; permissions:PlatformPermission[]; stats:CloudStats|null }
export interface CloudSync<T=unknown> { revision:number; data:T|null; updatedAt:string|null; stats:CloudStats }
export interface CloudTeam { id:string; name:string; description:string; ownerId:string; createdAt:string; memberCount:number; leaderboardEnabled:boolean; permissions:TeamPermission[] }
export interface CloudMember { userId:string; username:string; displayName:string; joinedAt:string; permissions:TeamPermission[]; shareStats:boolean; stats:CloudStats|null }
export interface CloudQuestionSet { id:string; title:string; description:string; questionIds:string[]; bankIds:string[]; questionRevisions?:Record<string,number>; /** Exported original bank archive, base64. Optional when referencing built-in collections. */ archiveBase64?:string }
export interface CloudAssignment { id:string; teamId:string; title:string; description:string; createdBy:string; createdAt:string; dueAt:string|null; questionSet:CloudQuestionSet; assigneeIds:string[]; progress:CloudAssignmentProgress[] }
export interface CloudAssignmentProgress { userId:string; completed:number; total:number; accuracy:number|null; lastPracticeAt:string|null }
export interface CloudTeamDetail { team:CloudTeam; members:CloudMember[]; assignments:CloudAssignment[] }
export interface CloudInvitation { id:string; teamId:string|null; teamName:string|null; createdAt:string; expiresAt:string; remainingUses:number; createdBy:string; maxUses:number; uses:number; paused:boolean; status:'active'|'paused'|'expired'|'used'; canManage:boolean; permissions:(PlatformPermission|TeamPermission)[]; /** Present only on creation. */ token?:string; url?:string }
export interface CloudDevice { id:string; label:string; browser:string; platform:string; timeZone:string; language:string; screen:string; createdAt:string; lastSeenAt:string; revoked:boolean }
export interface CloudAdminUser extends CloudUser { stats:CloudStats|null; devices?:CloudDevice[]; teamCount:number }
export interface CloudAudit { id:string; actorId:string|null; action:string; targetId:string|null; detail:Record<string,unknown>; createdAt:string }
export interface CloudApiError { error:string; message:string; revision?:number }
/** Routes: bootstrap GET; auth/start POST {mode,username?}, auth/logout POST; sync GET/PUT {revision,data}; profile PATCH {displayName?,shareStats?}; devices GET/POST; devices/:id DELETE; teams GET/POST {name,description?}; teams/:id GET/PATCH/DELETE; teams/:id/members/:userId PATCH {permissions?,remove?}; teams/:id/invitations GET/POST {permissions,expiresInDays?,maxUses?}; invitations/accept POST {token}; teams/:id/assignments POST, assignments/:id PATCH/DELETE {title,description?,questionSet,assigneeIds?,dueAt?}; admin/users GET (?q=&cursor=), admin/users/:id GET/PATCH {displayName?,banned?,banReason?,permissions?,statsAdjustment?:{xp:number,note:string}}; admin/settings GET/PATCH {guestAllowed}; admin/invitations GET/POST {permissions}; admin/audit GET. */

export interface CloudSiteOverview {users:number;activeUsers:number;administrators:number;teams:number;invitations:number;questions:number;earned:number;possible:number;completed:number}
export interface CloudProfile {user:Pick<CloudUser,'id'|'username'|'displayName'|'createdAt'>;activity:import('./activity').ActivitySummary;xp:number}
