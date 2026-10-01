"use client";

import Link from "next/link";
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "outline" | "danger" | "ghost" | "link";
export type ButtonSize = "default" | "small";

type SharedButtonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  children: ReactNode;
};

export type ButtonProps = SharedButtonProps & ComponentPropsWithoutRef<"button">;

function buttonClassName(variant: ButtonVariant, size: ButtonSize, className = "") {
  return [
    "btn",
    "ui-button",
    `btn-${variant}`,
    size === "small" ? "btn-small" : "",
    className,
  ].filter(Boolean).join(" ");
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "primary", size = "default", loading = false, disabled, children, className, ...props }, ref) {
  return (
    <button
      ref={ref}
      className={buttonClassName(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <span className="ui-button-spinner" aria-hidden="true" />}
      {children}
    </button>
  );
});

export type ButtonLinkProps = SharedButtonProps & ComponentPropsWithoutRef<typeof Link>;

export function ButtonLink({ variant = "primary", size = "default", loading = false, children, className, ...props }: ButtonLinkProps) {
  return (
    <Link
      className={buttonClassName(variant, size, className)}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <span className="ui-button-spinner" aria-hidden="true" />}
      {children}
    </Link>
  );
}

export default Button;
