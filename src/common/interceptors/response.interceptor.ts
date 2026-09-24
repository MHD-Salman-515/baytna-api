import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiSuccessResponse } from '../interfaces/api-response.interface';

interface PaginatedShape<T> {
  data: T;
  meta: Record<string, unknown>;
}

function isPaginatedShape(value: unknown): value is PaginatedShape<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'data' in value &&
    'meta' in value &&
    Object.keys(value as object).length === 2
  );
}

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiSuccessResponse<T>> {
  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<ApiSuccessResponse<T>> {
    return next.handle().pipe(
      map((result) => {
        if (isPaginatedShape(result)) {
          return { success: true, data: result.data as T, meta: result.meta };
        }
        return { success: true, data: result };
      }),
    );
  }
}
