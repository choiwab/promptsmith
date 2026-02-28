import { useMemo, useState } from "react";
import { Button } from "../../components/Button";
import { LoadingState } from "../../components/LoadingState";
import { useRequestStates } from "../../state/selectors";
import { useAppStore } from "../../state/store";

export const PromptWorkbench = () => {
  const [prompt, setPrompt] = useState("");
  const [seed, setSeed] = useState("");
  const generateCommit = useAppStore((state) => state.generateCommit);
  const requestStates = useRequestStates();

  const canSubmit = useMemo(() => {
    return prompt.trim().length > 0 && requestStates.generate !== "loading";
  }, [prompt, requestStates.generate]);

  const onSubmit = async () => {
    const trimmed = prompt.trim();
    if (!trimmed) {
      return;
    }

    await generateCommit(trimmed, seed.trim() || undefined);
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

      <div className="panel__actions">
        <Button variant="primary" loading={requestStates.generate === "loading"} disabled={!canSubmit} onClick={onSubmit}>
          Generate Commit
        </Button>
      </div>

      {requestStates.generate === "loading" ? <LoadingState message="Generating images and commit metadata..." /> : null}
    </section>
  );
};
