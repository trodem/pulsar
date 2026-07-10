import type { Request, Response, NextFunction, RequestHandler } from "express";

// Wraps an async route handler so a rejected promise is forwarded to Express's
// error middleware instead of becoming an unhandled rejection. Express 4 only
// catches synchronous throws; once handlers became async (libSQL queries are
// awaited) this is required to preserve the previous "throw -> 500" behavior.
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
