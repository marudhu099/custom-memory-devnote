export class NotionService {
  private token: string;
  private databaseId: string;

  constructor(token: string, databaseId: string) {
    this.token = token;
    this.databaseId = databaseId;
  }

  async push(title: string, content: string): Promise<{ pageId: string; pageUrl: string }> {
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

    const data = (await response.json()) as { id: string; url: string };
    return { pageId: data.id, pageUrl: data.url };
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

  async replacePageBlocks(pageId: string, content: string): Promise<void> {
    // Step 1: List existing block IDs
    const listResponse = await fetch(
      `https://api.notion.com/v1/blocks/${pageId}/children`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Notion-Version': '2022-06-28',
        },
      }
    );

    if (!listResponse.ok) {
      const error = await listResponse.text();
      throw new Error(
        `Notion API error listing blocks (${listResponse.status}): ${error}`
      );
    }

    const listData = (await listResponse.json()) as {
      results: Array<{ id: string }>;
    };

    // Step 2: Delete each existing block
    for (const block of listData.results) {
      const deleteResponse = await fetch(
        `https://api.notion.com/v1/blocks/${block.id}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Notion-Version': '2022-06-28',
          },
        }
      );

      if (!deleteResponse.ok) {
        const error = await deleteResponse.text();
        throw new Error(
          `Notion API error deleting block (${deleteResponse.status}): ${error}`
        );
      }
    }

    // Step 3: Append new blocks (reuses existing method)
    await this.appendBlocksToPage(pageId, content);
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
