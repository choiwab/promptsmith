import { useMemo, useState } from "react";
import { Button } from "../../components/Button";
import { LoadingState } from "../../components/LoadingState";
import { useRequestStates, useSelectedCommitId } from "../../state/selectors";
import { useAppStore } from "../../state/store";

export const PromptWorkbench = () => {
  const minPromptLength = 5;
  const [prompt, setPrompt] = useState("");
  const [seed, setSeed] = useState("");
  const [linkToSelected, setLinkToSelected] = useState(true);
  const selectedCommitId = useSelectedCommitId();
  const generateCommit = useAppStore((state) => state.generateCommit);
  const requestStates = useRequestStates();
  const promptLength = prompt.trim().length;
  const parentCommitId = linkToSelected ? selectedCommitId : undefined;

  const canSubmit = useMemo(() => {
    return promptLength >= minPromptLength && requestStates.generate !== "loading";
  }, [promptLength, minPromptLength, requestStates.generate]);

  const onSubmit = async () => {
    const trimmed = prompt.trim();
    if (trimmed.length < minPromptLength) {
      return;
    }

    await generateCommit(trimmed, seed.trim() || undefined, parentCommitId);
    setPrompt("");
  };

  return (
    <section className="panel panel--workbench">
      <header className="panel__header">
        <h2>Prompt Workbench</h2>
        <p>Create a generation commit from a prompt.</p>
      </header>

      <label htmlFor="prompt-input" className="field-label">
        Prompt
      </label>
      <textarea
        id="prompt-input"
        className="field"
        rows={8}
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder="cinematic portrait of hero character in studio lighting"
      />
      <p className="field-hint">Use at least {minPromptLength} characters.</p>

      <label htmlFor="seed-input" className="field-label">
        Seed (optional)
      </label>
      <input
        id="seed-input"
        className="field"
        value={seed}
        onChange={(event) => setSeed(event.target.value)}
        placeholder="1234"
      />

      <label className="checkbox-field" htmlFor="lineage-parent-toggle">
        <input
          id="lineage-parent-toggle"
          type="checkbox"
          checked={linkToSelected}
          disabled={!selectedCommitId}
          onChange={(event) => setLinkToSelected(event.target.checked)}
        />
        <span>
          Use selected commit as lineage parent
          {selectedCommitId ? <strong> ({selectedCommitId})</strong> : " (none selected)"}
        </span>
      </label>
      <p className="field-hint">
        If no parent is selected, backend uses the latest commit in this project as generation context.
      </p>

      <div className="panel__actions">
        <Button variant="primary" loading={requestStates.generate === "loading"} disabled={!canSubmit} onClick={onSubmit}>
          Generate Commit
        </Button>
      </div>

      {requestStates.generate === "loading" ? <LoadingState message="Generating images and commit metadata..." /> : null}
    </section>
  );
};
