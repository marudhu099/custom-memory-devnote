export class NotionService {
  private token: string;
  private databaseId: string;

  constructor(token: string, databaseId: string) {
    this.token = token;
    this.databaseId = databaseId;
  }

  async push(title: string, content: string): Promise<void> {
    const body = {
      parent: { database_id: this.databaseId },
      properties: {
        Name: {
          title: [{ text: { content: title } }],
        },
      },
      children: this.markdownToBlocks(content),
    };

    const response = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Notion API error (${response.status}): ${error}`);
    }
  }

  async findPageByTitle(title: string): Promise<string | null> {
    const body = {
      filter: {
        property: 'Name',
        title: {
          equals: title,
        },
      },
      page_size: 1,
    };

    const response = await fetch(
      `https://api.notion.com/v1/databases/${this.databaseId}/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          'Notion-Version': '2022-06-28',
        },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Notion API error (${response.status}): ${error}`);
    }

    const data = (await response.json()) as { results: Array<{ id: string }> };
    if (data.results.length === 0) {
      return null;
    }

    return data.results[0].id;
  }

  async appendBlocksToPage(pageId: string, content: string): Promise<void> {
    const body = {
      children: this.markdownToBlocks(content),
    };

    const response = await fetch(
      `https://api.notion.com/v1/blocks/${pageId}/children`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          'Notion-Version': '2022-06-28',
        },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Notion API error (${response.status}): ${error}`);
    }
  }

  private markdownToBlocks(content: string): object[] {
    const lines = content.split('\n');
    const blocks: object[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      if (trimmed.startsWith('## ')) {
        blocks.push({
          object: 'block',
          type: 'heading_2',
          heading_2: {
            rich_text: [{ type: 'text', text: { content: trimmed.slice(3) } }],
          },
        });
      } else if (trimmed.startsWith('- ')) {
        blocks.push({
          object: 'block',
          type: 'bulleted_list_item',
          bulleted_list_item: {
            rich_text: [{ type: 'text', text: { content: trimmed.slice(2) } }],
          },
        });
      } else {
        blocks.push({
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ type: 'text', text: { content: trimmed } }],
          },
        });
      }
    }

    return blocks;
  }
}
