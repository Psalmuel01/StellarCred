import React from "react";
import { docsSections, DocSection } from "./data/docsContent";

export default function DocsPage() {
  return (
    <div className="flex min-h-screen">
      {/* Table of Contents / Sidebar */}
      <aside className="w-64 border-r p-6 hidden md:block">
        <h2 className="text-lg font-bold mb-4">Documentation</h2>
        <nav className="space-y-2">
          {docsSections.map((section: DocSection) => (
            <div key={section.id}>
              <a href={`#${section.id}`} className="font-semibold block hover:underline">
                {section.title}
              </a>
              {section.subsections && (
                <ul className="pl-4 mt-1 space-y-1 text-sm text-gray-600">
                  {section.subsections.map((sub) => (
                    <li key={sub.id}>
                      <a href={`#${sub.id}`} className="hover:underline">
                        {sub.title}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </nav>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 p-8">
        <h1 className="text-3xl font-bold mb-8">StellarCred Documentation</h1>
        {docsSections.map((section: DocSection) => (
          <section key={section.id} id={section.id} className="mb-12">
            <h2 className="text-2xl font-semibold mb-4 border-b pb-2">{section.title}</h2>
            {section.content && <p className="mb-4 text-gray-700">{section.content}</p>}
            {section.subsections?.map((sub) => (
              <div key={sub.id} id={sub.id} className="mb-6 pl-4 border-l-2 border-gray-200">
                <h3 className="text-xl font-medium mb-2">{sub.title}</h3>
                <p className="text-gray-600">{sub.content}</p>
              </div>
            ))}
          </section>
        ))}
      </main>
    </div>
  );
}
