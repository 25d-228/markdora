import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function App() {
  return (
    <div className="flex min-h-svh w-full flex-col bg-background text-foreground">
      <header className="border-b px-6 py-4">
        <h1 className="text-xl font-semibold tracking-tight">Markdora</h1>
      </header>
      <main className="flex min-h-0 flex-1 items-center justify-center p-6">
        <Card className="w-full max-w-2xl">
          <CardHeader>
            <CardTitle>
              <h2>No document open</h2>
            </CardTitle>
            <CardDescription>
              Open or create a Markdown document to begin.
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    </div>
  );
}

export default App;
