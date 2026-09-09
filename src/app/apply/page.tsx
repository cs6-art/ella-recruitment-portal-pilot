import Link from "next/link";
import { getRoleRequests, isPublishedRoleForIntake } from "@/lib/google-sheets";

// Public role catalogue data can tolerate a short freshness window. The
// application POST route revalidates the role live before accepting a form.
export const revalidate = 60;

export default async function ApplyIndexPage() {
  const roles = (await getRoleRequests({ liveOnly: true })).filter(isPublishedRoleForIntake);
  return <main className="container page"><section className="card"><p className="eyebrow">McLink Careers</p><h1>Open roles</h1><div className="role-list">{roles.length === 0 ? <p>No published roles are currently accepting applications.</p> : roles.map((role) => <article className="card" key={role.roleId}><h2>{role.jobTitle}</h2><p>{role.department}</p><Link className="btn btn-primary" href={`/apply/${encodeURIComponent(role.roleId)}`}>View and apply</Link></article>)}</div></section></main>;
}
