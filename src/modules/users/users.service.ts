import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Role } from '../../common/enums/role.enum';
import { User, UserDocument, UserStatus } from './schemas/user.schema';

export type AdminSeedOutcome = 'created' | 'promoted' | 'unchanged';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private readonly userModel: Model<UserDocument>) {}

  async findByPhone(phone: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ phone, isDeleted: false }).exec();
  }

  async findById(id: string): Promise<UserDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('User not found');
    }
    const user = await this.userModel.findOne({ _id: id, isDeleted: false }).exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  /**
   * Find-or-create keyed on phone. New users default to CUSTOMER — WORKER is
   * granted through a separate onboarding flow later. Handles the race where
   * two concurrent OTP verifications for the same brand-new number both pass
   * the initial findOne: the loser's create() hits the unique index on
   * `phone` (code 11000) and falls back to re-fetching the winner's record,
   * rather than erroring the request out.
   */
  async findOrCreateByPhone(
    phone: string,
    countryId: string,
  ): Promise<{ user: UserDocument; isNewUser: boolean }> {
    const existing = await this.userModel.findOne({ phone, isDeleted: false }).exec();
    if (existing) {
      return { user: existing, isNewUser: false };
    }

    try {
      const user = await this.userModel.create({
        phone,
        countryId,
        roles: [Role.CUSTOMER],
        status: UserStatus.ACTIVE,
      });
      return { user, isNewUser: true };
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        const user = await this.userModel.findOne({ phone, isDeleted: false }).exec();
        if (user) {
          return { user, isNewUser: false };
        }
      }
      throw error;
    }
  }

  async recordLogin(userId: Types.ObjectId | string): Promise<void> {
    await this.userModel.updateOne({ _id: userId }, { lastLoginAt: new Date() }).exec();
  }

  /** Idempotent: adds `role` if not already present. Never removes any existing role. */
  async addRole(userId: string, role: Role): Promise<UserDocument> {
    const user = await this.findById(userId);
    if (!user.roles.includes(role)) {
      user.roles = [...user.roles, role];
      await user.save();
    }
    return user;
  }

  /** Idempotent: creates the user with ADMIN if missing, promotes an existing user to include ADMIN otherwise. */
  async upsertAdmin(
    phone: string,
    countryId: string,
  ): Promise<{ user: UserDocument; outcome: AdminSeedOutcome }> {
    const existing = await this.userModel.findOne({ phone, isDeleted: false }).exec();

    if (!existing) {
      const user = await this.userModel.create({
        phone,
        countryId,
        roles: [Role.ADMIN],
        status: UserStatus.ACTIVE,
      });
      return { user, outcome: 'created' };
    }

    if (existing.roles.includes(Role.ADMIN)) {
      return { user: existing, outcome: 'unchanged' };
    }

    existing.roles = [...existing.roles, Role.ADMIN];
    await existing.save();
    return { user: existing, outcome: 'promoted' };
  }
}
