import { useState } from "react";
import { Button } from "../../components/Button";
import { Modal } from "../../components/Modal";
import { useProjectId, useProjects, useRequestStates } from "../../state/selectors";
import { useAppStore } from "../../state/store";
import type { Project } from "../../api/types";

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
  const deleteProject = useAppStore((state) => state.deleteProject);

  const [collapsed, setCollapsed] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newProjectId, setNewProjectId] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);

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

  const handleDelete = () => {
    if (!projectToDelete) {
      return;
    }

    const id = projectToDelete.project_id;
    void deleteProject(id);
    setProjectToDelete(null);
    if (id === projectId) {
      onMobileClose?.();
    }
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
                <div className="sidebar__item-row">
                  <button
                    className="sidebar__item-btn"
                    onClick={() => handleSelect(project.project_id)}
                    disabled={requestStates.project === "loading"}
                  >
                    <span className="sidebar__item-name">{project.name}</span>
                    <span className="sidebar__item-id">{project.project_id}</span>
                    <span className="sidebar__item-date">{relativeTime(project.updated_at)}</span>
                  </button>
                  <button
                    className="sidebar__item-delete"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setProjectToDelete(project);
                    }}
                    aria-label={`Delete project ${project.project_id}`}
                    title={`Delete project ${project.project_id}`}
                    disabled={requestStates.project === "loading"}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M9 3h6l1 2h5v2H3V5h5l1-2Zm1 7h2v8h-2v-8Zm4 0h2v8h-2v-8ZM7 10h2v8H7v-8Zm-1 12h12a2 2 0 0 0 2-2V8H4v12a2 2 0 0 0 2 2Z"
                        fill="currentColor"
                      />
                    </svg>
                  </button>
                </div>
              </li>
            ))}
            {projects.length === 0 && (
              <li style={{ padding: "var(--space-3)", color: "var(--text-muted)", fontSize: "0.85rem" }}>
                No projects yet
              </li>
            )}
          </ul>
        </nav>

        <Modal
          open={Boolean(projectToDelete)}
          title="Delete Project"
          size="md"
          onClose={() => setProjectToDelete(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setProjectToDelete(null)} disabled={requestStates.project === "loading"}>
                Cancel
              </Button>
              <Button variant="danger" loading={requestStates.project === "loading"} onClick={handleDelete}>
                Delete Project
              </Button>
            </>
          }
        >
          {projectToDelete ? (
            <section className="project-delete-confirm">
              <p className="project-delete-confirm__lead">
                This action is permanent and cannot be undone.
              </p>
              <div className="project-delete-confirm__meta">
                <p>
                  <span>Project name</span>
                  <strong>{projectToDelete.name}</strong>
                </p>
                <p>
                  <span>Project id</span>
                  <strong>{projectToDelete.project_id}</strong>
                </p>
              </div>
              <p className="project-delete-confirm__warning">
                Deleting this project removes all commits, eval runs, comparisons, and generated artifacts under this project.
              </p>
            </section>
          ) : null}
        </Modal>
      </aside>
    </>
  );
};
