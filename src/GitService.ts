import simpleGit, { SimpleGit } from 'simple-git';

export interface DiffResult {
  staged: string;
  unstaged: string;
  filesChanged: string[];
}

export class GitService {
  private readonly git: SimpleGit;

  constructor(workspacePath: string) {
    this.git = simpleGit(workspacePath);
  }

  async checkAvailability(): Promise<{ available: boolean; reason?: string }> {
    const isRepo = await this.git.checkIsRepo();
    if (!isRepo) {
      return { available: false, reason: 'Not a git repository' };
    }

    const status = await this.git.status();
    const hasChanges =
      status.modified.length > 0 ||
      status.not_added.length > 0 ||
      status.staged.length > 0 ||
      status.renamed.length > 0 ||
      status.deleted.length > 0;

    if (!hasChanges) {
      return { available: false, reason: 'No uncommitted changes found' };
    }

    return { available: true };
  }

  async getDiff(): Promise<DiffResult> {
    const staged = await this.git.diff(['--cached']);
    const unstaged = await this.git.diff();
    const status = await this.git.status();

    const filesChanged = [
      ...new Set([
        ...status.modified,
        ...status.not_added,
        ...status.staged,
        ...status.renamed.map((entry) => entry.to),
        ...status.deleted,
      ]),
    ];

    return { staged, unstaged, filesChanged };
  }
}
