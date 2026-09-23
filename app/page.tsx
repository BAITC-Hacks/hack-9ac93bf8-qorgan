import SearchForm from "@/components/SearchForm";
import { loadContractors } from "@/lib/catalog";

export default function Home() {
  let categories: string[] = [];
  let formatsById: Record<string, string[]> = {};
  let catalogError = false;
  try {
    const contractors = loadContractors();
    categories = [...new Set(contractors.flatMap((contractor) => contractor.categories))]
      .sort((a, b) => a.localeCompare(b, "ru"));
    formatsById = Object.fromEntries(contractors.map((contractor) => [contractor.id, contractor.event_formats]));
  } catch {
    catalogError = true;
  }
  if (catalogError) {
    return (
      <main className="page">
        <h1>Подбор подрядчиков</h1>
        <p role="alert">Каталог сейчас недоступен. Проверьте файл данных и перезагрузите страницу.</p>
      </main>
    );
  }
  return (
    <main className="page">
      <header className="page-header">
        <span className="brand">Qorgan</span>
        <h1>Подбор подрядчиков</h1>
        <p className="page-intro">До 3 свободных подрядчиков под ваш запрос с объяснением, почему именно они.</p>
      </header>
      <SearchForm categories={categories} formatsById={formatsById} />
    </main>
  );
}
