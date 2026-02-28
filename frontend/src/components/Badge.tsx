import type { PropsWithChildren } from "react";

type BadgeVariant = "pass" | "fail" | "inconclusive" | "baseline" | "status";

interface BadgeProps {
  variant: BadgeVariant;
}

export const Badge = ({ variant, children }: PropsWithChildren<BadgeProps>) => {
  return <span className={`badge badge--${variant}`}>{children}</span>;
};
