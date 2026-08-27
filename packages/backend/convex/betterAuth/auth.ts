import { createAuth } from "../auth"

// Introspection-only instance for the Better Auth schema generator. It is never
// reachable as a Convex function and never serves a request, so it does not need
// the deployment secret — and requiring one here breaks component analysis at
// deploy time, since Convex components have an isolated environment.
export const auth = createAuth({} as any, { requireSecret: false })
