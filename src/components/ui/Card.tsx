import type { HTMLAttributes, ReactNode } from "react";

type CardProps = HTMLAttributes<HTMLElement> & {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
};

export default function Card({ title, description, actions, footer, children, className = "", ...props }: CardProps) {
  return (
    <section className={`card ui-card ${className}`.trim()} {...props}>
      {(title || description || actions) && (
        <div className="card-header ui-card-header">
          <div>
            {title && <h2>{title}</h2>}
            {description && <p>{description}</p>}
          </div>
          {actions && <div className="ui-card-actions">{actions}</div>}
        </div>
      )}
      <div className="ui-card-body">{children}</div>
      {footer && <div className="ui-card-footer">{footer}</div>}
    </section>
  );
}
