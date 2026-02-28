import { useState } from "react";
import { Button } from "../../components/Button";
import { useProjectId, useProjects, useRequestStates } from "../../state/selectors";
import { useAppStore } from "../../state/store";

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

interface ProjectSidebarProps {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export const ProjectSidebar = ({ mobileOpen, onMobileClose }: ProjectSidebarProps) => {
  const projects = useProjects();
  const projectId = useProjectId();
  const requestStates = useRequestStates();
  const setProject = useAppStore((state) => state.setProject);

  const [collapsed, setCollapsed] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newProjectId, setNewProjectId] = useState("");
  const [newProjectName, setNewProjectName] = useState("");

  const handleCreate = async () => {
    const id = newProjectId.trim();
    if (!id) return;
    await setProject(id, newProjectName.trim() || undefined);
    setNewProjectId("");
    setNewProjectName("");
    setShowCreateForm(false);
  };

  const handleSelect = (id: string) => {
    if (id === projectId) return;
    void setProject(id);
    onMobileClose?.();
  };

  return (
    <>
      {/* backdrop for mobile overlay */}
      <div
        className={`sidebar__backdrop${mobileOpen ? " sidebar__backdrop--visible" : ""}`}
        onClick={onMobileClose}
      />
      <aside className={`sidebar${mobileOpen ? " sidebar--open" : ""}${collapsed ? " sidebar--collapsed" : ""}`}>
        <div className="sidebar__header">
          <button
            className="sidebar__collapse-btn"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? "\u25B6" : "\u25C0"}
          </button>
          <h2 className="sidebar__title">Projects</h2>
          <Button
            variant="primary"
            onClick={() => setShowCreateForm((v) => !v)}
          >
            + New
          </Button>
        </div>

        {showCreateForm && (
          <form
            className="sidebar__create-form"
            onSubmit={(e) => {
              e.preventDefault();
              void handleCreate();
            }}
          >
            <input
              className="field"
              placeholder="project-id"
              value={newProjectId}
              onChange={(e) => setNewProjectId(e.target.value)}
              autoFocus
            />
            <input
              className="field"
              placeholder="Display name (optional)"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
            />
            <div className="sidebar__create-actions">
              <Button
                variant="primary"
                type="submit"
                loading={requestStates.project === "loading"}
                disabled={newProjectId.trim().length === 0}
              >
                Create
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setShowCreateForm(false);
                  setNewProjectId("");
                  setNewProjectName("");
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}

        <nav className="sidebar__list" aria-label="Project list">
          <ul>
            {projects.map((project) => (
              <li
                key={project.project_id}
                className={`sidebar__item${project.project_id === projectId ? " sidebar__item--active" : ""}`}
              >
                <button
                  className="sidebar__item-btn"
                  onClick={() => handleSelect(project.project_id)}
                >
                  <span className="sidebar__item-name">{project.name}</span>
                  <span className="sidebar__item-id">{project.project_id}</span>
                  <span className="sidebar__item-date">{relativeTime(project.updated_at)}</span>
                </button>
              </li>
            ))}
            {projects.length === 0 && (
              <li style={{ padding: "var(--space-3)", color: "var(--text-muted)", fontSize: "0.85rem" }}>
                No projects yet
              </li>
            )}
          </ul>
        </nav>
      </aside>
    </>
  );
};
