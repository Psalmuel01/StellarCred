'use client';

import React, { useState, useMemo } from "react";
import { docsContent, DocSection } from "./data/docsContent";

export default function DocsPage() {
  const [searchQuery, setSearchQuery] = useState("");

  // Filter sections and subsections based on in-page search query
  const filteredSections = useMemo(() => {
    if (!searchQuery.trim()) return docsContent;

    const query = searchQuery.toLowerCase();
    return docsContent
      .map((section: DocSection) => {
        const matchesTitle = section.title.toLowerCase().includes(query);
        const matchesContent = section.content?.toLowerCase().includes(query);
        const matchingItems = section.items?.filter(
          (item) =>
            item.title.toLowerCase().includes(query) ||
            item.content.toLowerCase().includes(query)
        );

        if (matchesTitle || matchesContent || (matchingItems && matchingItems.length > 0)) {
          return {
            ...section,
            items: matchingItems && matchingItems.length > 0 ? matchingItems : section.items,
          };
        }
        return null;
      })
      .filter(Boolean) as DocSection[];
  }, [searchQuery]);

  return (
    <div className="flex min-h-screen">
      {/* Table of Contents / Sidebar */}
      <aside className="w-64 p-6 border-r sticky top-0 h-screen overflow-y-auto hidden md:block">
        <div className="mb-4">
          <input
            type="text"
            placeholder="Search docs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2"
          />
        </div>
        <nav className="space-y-2">
          {docsContent.map((section) => (
            <div key={section.id}>
              <a
                href={`#${section.id}`}
                className="block py-1 text-sm font-semibold hover:text-blue-600"
              >
                {section.title}
              </a>
              {section.items && (
                <div className="pl-3 space-y-1">
                  {section.items.map((item) => (
                    <a
                      key={item.id}
                      href={`#${item.id}`}
                      className="block py-0.5 text-xs text-gray-600 hover:text-blue-600"
                    >
                      {item.title}
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
      </aside>

      {/* Main Documentation Content */}
      <main className="flex-1 p-8 max-w-4xl overflow-y-auto">
        {filteredSections.length === 0 ? (
          <p className="text-gray-500">No documentation found matching "{searchQuery}".</p>
        ) : (
          filteredSections.map((section) => (
            <section key={section.id} id={section.id} className="mb-12 scroll-mt-6">
              <h1 className="text-3xl font-bold mb-4">{section.title}</h1>
              {section.content && <p className="text-gray-700 mb-6">{section.content}</p>}
              
              {section.items &&
                section.items.map((item) => (
                  <div key={item.id} id={item.id} className="mb-8 scroll-mt-6">
                    <h2 className="text-xl font-semibold mb-2">{item.title}</h2>
                    <p className="text-gray-600 leading-relaxed">{item.content}</p>
                  </div>
                ))}
            </section>
          ))
        )}
      </main>
    </div>
  );
}
