import type { HTMLAttributes, ReactNode } from "react";
import UiIcon from "@/components/UiIcon";

export type AlertTone = "success" | "warning" | "error" | "info" | "neutral";

type AlertProps = Omit<HTMLAttributes<HTMLDivElement>, "title"> & {
  tone?: AlertTone;
  title?: ReactNode;
  children: ReactNode;
};

const icons = {
  success: "check-circle",
  warning: "alert",
  error: "alert",
  info: "info",
  neutral: "info",
} as const;

export default function Alert({ tone = "info", title, children, className = "", ...props }: AlertProps) {
  return (
    <div className={`ui-alert ui-alert-${tone} ${className}`.trim()} role={tone === "error" ? "alert" : "status"} {...props}>
      <span className="ui-alert-icon" aria-hidden="true"><UiIcon name={icons[tone]} size={17} /></span>
      <div className="ui-alert-content">
        {title && <strong>{title}</strong>}
        <div>{children}</div>
      </div>
    </div>
  );
}
