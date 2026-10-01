import type { ReactNode } from "react";

type PageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  className?: string;
};

export default function PageHeader({ title, description, eyebrow, actions, meta, className = "" }: PageHeaderProps) {
  return (
    <header className={`hero-row ui-page-header ${className}`.trim()}>
      <div className="ui-page-header-copy">
        {eyebrow && <span className="eyebrow-dark ui-page-header-eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
        {meta && <div className="ui-page-header-meta">{meta}</div>}
      </div>
      {actions && <div className="hero-actions ui-page-header-actions">{actions}</div>}
    </header>
  );
}
