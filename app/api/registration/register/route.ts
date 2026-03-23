import { handleRegisterWebsiteUserRequest } from "../../../lib/registration-lifecycle";

export async function POST(request: Request): Promise<Response> {
  return handleRegisterWebsiteUserRequest(request);
}
