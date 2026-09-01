import { ContentType } from '../enums/content-type.enum.js';
import { StatusCode } from '../enums/status-code.enum.js';

export interface ApiResponse<T> {
  statusCode: StatusCode;
  contentType: ContentType;
  body: T;
}

export function jsonResponse<T>(statusCode: StatusCode, body: T): ApiResponse<T> {
  return { statusCode, contentType: ContentType.JSON, body };
}

export function sendJson<T>(res: import('express').Response, statusCode: StatusCode, body: T) {
  res.status(statusCode).type(ContentType.JSON).json(body);
}
