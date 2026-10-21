import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreateTrustedContactDto } from './dto/create-trusted-contact.dto';
import { TrustedContact, TrustedContactDocument } from './schemas/trusted-contact.schema';

/**
 * Self-service only — no admin endpoint touches another user's contacts.
 * Sending anything to a contact requires SMS, which this app doesn't have
 * yet (see PanicAlertsService's own comment) — this is purely the record
 * and the seam.
 */
@Injectable()
export class TrustedContactsService {
  constructor(
    @InjectModel(TrustedContact.name) private readonly contactModel: Model<TrustedContactDocument>,
  ) {}

  async listOwn(userId: string): Promise<TrustedContactDocument[]> {
    return this.contactModel.find({ userId, isDeleted: false }).sort({ createdAt: 1 }).exec();
  }

  async addOwn(userId: string, dto: CreateTrustedContactDto): Promise<TrustedContactDocument> {
    return this.contactModel.create({
      userId,
      name: dto.name,
      phone: dto.phone,
      relationship: dto.relationship,
    });
  }

  async removeOwn(userId: string, contactId: string): Promise<void> {
    const contact = await this.contactModel
      .findOne({ _id: contactId, userId, isDeleted: false })
      .exec();
    if (!contact) {
      throw new NotFoundException('Trusted contact not found');
    }
    contact.isDeleted = true;
    contact.deletedAt = new Date();
    await contact.save();
  }
}
