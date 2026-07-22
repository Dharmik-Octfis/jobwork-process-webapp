import type { Request, Response, NextFunction } from 'express';

export function responseFormatter(_req: Request, res: Response, next: NextFunction) {
  const originalJson = res.json;

  res.json = function (body: unknown) {
    // Avoid double-wrapping if the response is already in the expected format
    if (
      body &&
      typeof body === 'object' &&
      'statusCode' in body &&
      'message' in body &&
      'data' in body
    ) {
      return originalJson.call(this, body);
    }

    const statusCode = res.statusCode || 200;

    let message = 'Success';
    let data = body;

    // Check if body contains a specific message we want to extract
    if (body && typeof body === 'object' && 'message' in body && typeof (body as Record<string, unknown>).message === 'string') {
      message = (body as Record<string, unknown>).message as string;
      const dataObj = { ...body } as Record<string, unknown>;
      delete dataObj.message;
      data = dataObj;
      
      if (Object.keys(dataObj).length === 0) {
        data = null;
      }
    } else if (statusCode >= 400 && statusCode < 500) {
      message = 'Client Error';
    } else if (statusCode >= 500) {
      message = 'Server Error';
    }

    const formattedResponse = {
      statusCode,
      message,
      data: data !== undefined ? data : null,
    };

    return originalJson.call(this, formattedResponse);
  };

  next();
}
