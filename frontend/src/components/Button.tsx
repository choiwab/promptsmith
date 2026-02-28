import type { ButtonHTMLAttributes, PropsWithChildren } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
}

export const Button = ({
  variant = "primary",
  loading = false,
  className,
  children,
  disabled,
  ...rest
}: PropsWithChildren<ButtonProps>) => {
  return (
    <button
      type="button"
      className={`btn btn--${variant}${className ? ` ${className}` : ""}`}
      disabled={disabled || loading}
      aria-busy={loading}
      {...rest}
    >
      {loading ? "Working..." : children}
    </button>
  );
};
