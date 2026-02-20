import { handleOnboardingStepRequest } from "../../../lib/onboarding-step-handler";

export async function POST(request: Request): Promise<Response> {
  return handleOnboardingStepRequest(request);
}
