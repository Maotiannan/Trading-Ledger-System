import { Loader2 } from 'lucide-react';

export default function WorkspaceLoading() {
  return (
    <div className="h-full min-h-[calc(100vh-3rem)] flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin" />
    </div>
  );
}
