import { Role } from '../enums/role.enum';

/** Shape of `request.user`, populated by JwtAuthGuard from a verified access token. */
export interface AuthenticatedUser {
  userId: string;
  roles: Role[];
}
