import type { TaskMeta } from "vitest";
type ContentType = string | Record<string, string>;
export type Chapter = {
  name: string;
  content: ContentType;
};

export class Story {
  chapters: Chapter[];
  constructor() {
    this.chapters = [];
  }

  add_chapter(name: string, content: ContentType) {
    this.chapters.push({ name, content });
  }

  async writeToMeta(meta: TaskMeta) {
    for (let i = 0; i < this.chapters.length; ++i) {
      let chapter = this.chapters[i];
      let key = `${i + 1}. ${chapter.name}`;
      if (typeof chapter.content == "string") {
        meta[key] = chapter.content;
      } else {
        meta[key] = JSON.stringify(chapter.content, null, 2);
      }
    }
  }
}
