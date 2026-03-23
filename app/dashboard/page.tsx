import { Dashboard } from "@/components/Dashboard";

type DashboardPageProps = {
  searchParams?: Record<string, string | string[] | undefined>;
};

export default function DashboardPage(props: DashboardPageProps) {
  const checkoutState = normalizeQueryParam(props.searchParams?.checkout);

  return <Dashboard checkoutState={checkoutState === "success" || checkoutState === "cancel" ? checkoutState : null} />;
}

function normalizeQueryParam(value: string | string[] | undefined): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0].trim();
  }

  return "";
}
