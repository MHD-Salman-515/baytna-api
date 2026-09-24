import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CountriesModule } from '../countries/countries.module';
import { PhoneValidationService } from './phone-validation.service';
import { User, UserSchema } from './schemas/user.schema';
import { UsersService } from './users.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]), CountriesModule],
  providers: [UsersService, PhoneValidationService],
  exports: [UsersService, PhoneValidationService],
})
export class UsersModule {}
