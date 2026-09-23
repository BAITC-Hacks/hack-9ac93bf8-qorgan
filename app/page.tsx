import SearchForm from "@/components/SearchForm";
import { loadContractors } from "@/lib/catalog";

export default function Home() {
  let categories: string[] = [];
  let catalogError = false;
  try {
    categories = [...new Set(loadContractors().flatMap((contractor) => contractor.categories))]
      .sort((a, b) => a.localeCompare(b, "ru"));
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
      </header>
      <SearchForm categories={categories} />
    </main>
  );
}
