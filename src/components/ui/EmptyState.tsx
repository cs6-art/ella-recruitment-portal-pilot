import type { ReactNode } from "react";
import UiIcon, { type UiIconName } from "@/components/UiIcon";

type EmptyStateProps = {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: UiIconName;
  className?: string;
};

export default function EmptyState({ title, description, action, icon = "info", className = "" }: EmptyStateProps) {
  return (
    <div className={`ui-empty-state ${className}`.trim()}>
      <span className="ui-empty-state-icon" aria-hidden="true"><UiIcon name={icon} size={20} /></span>
      <strong>{title}</strong>
      {description && <p>{description}</p>}
      {action && <div className="ui-empty-state-action">{action}</div>}
    </div>
  );
}
