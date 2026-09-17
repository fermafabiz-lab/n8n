import ScrollHero from "@/components/ScrollHero";

export default function Page() {
  return (
    <main>
      <ScrollHero />
      <section className="test-section" data-testid="after-hero">
        <p>Test section — ordinary scroll resumes here.</p>
      </section>
    </main>
  );
}
