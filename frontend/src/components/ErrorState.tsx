import { Button } from "./Button";

interface ErrorStateProps {
  title?: string;
  code?: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}

export const ErrorState = ({
  title = "Something went wrong",
  code,
  message,
  onRetry,
  retryLabel = "Retry"
}: ErrorStateProps) => {
  return (
    <section className="state state--error" role="alert">
      <h3>{title}</h3>
      {code ? <p className="state__meta">{code}</p> : null}
      <p>{message}</p>
      {onRetry ? (
        <Button variant="danger" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </section>
  );
};
