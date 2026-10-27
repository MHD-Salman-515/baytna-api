import { ArgumentMetadata, Injectable, NotFoundException, PipeTransform } from '@nestjs/common';
import { Types } from 'mongoose';

/**
 * Applied to every route param that reaches a raw Mongoose `_id` query. A
 * malformed id must behave exactly like a well-formed id that simply
 * doesn't exist — 404 — never the 500 a Mongoose CastError/BSONError would
 * otherwise produce once it escapes uncaught to the global exception
 * filter, which only distinguishes HttpException from everything else.
 */
@Injectable()
export class ParseObjectIdPipe implements PipeTransform<string, string> {
  transform(value: string, _metadata: ArgumentMetadata): string {
    if (!Types.ObjectId.isValid(value)) {
      throw new NotFoundException('Resource not found');
    }
    return value;
  }
}
