interface LoadingStateProps {
  message: string;
}

export const LoadingState = ({ message }: LoadingStateProps) => {
  return (
    <div className="state state--loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
};
