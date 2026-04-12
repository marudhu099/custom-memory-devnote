import simpleGit, { SimpleGit } from 'simple-git';

export interface BranchDiffResult {
  branchDiff: string;
  filesChanged: string[];
  commitCount: number;
  baseBranch: string;
}

export interface UncommittedDiffResult {
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

    const onBase = await this.isOnBaseBranch();
    if (onBase) {
      const status = await this.git.status();
      const hasChanges =
        status.modified.length > 0 ||
        status.not_added.length > 0 ||
        status.staged.length > 0 ||
        status.renamed.length > 0 ||
        status.deleted.length > 0;

      if (!hasChanges) {
        return { available: false, reason: 'On base branch with no uncommitted changes' };
      }

      return { available: true };
    }

    return { available: true };
  }

  async isOnBaseBranch(): Promise<boolean> {
    const current = await this.git.revparse(['--abbrev-ref', 'HEAD']);
    const baseBranch = await this.getBaseBranch();
    return current.trim() === baseBranch;
  }

  async getBaseBranch(): Promise<string> {
    // Check which base branch exists: main or master
    const branches = await this.git.branchLocal();
    if (branches.all.includes('main')) {
      return 'main';
    }
    if (branches.all.includes('master')) {
      return 'master';
    }
    // Fallback: use the first branch in the list
    return branches.all[0] || 'main';
  }

  async getBranchDiff(): Promise<BranchDiffResult> {
    const baseBranch = await this.getBaseBranch();
    const branchDiff = await this.git.diff([`${baseBranch}...HEAD`]);
    const diffStat = await this.git.diff([`${baseBranch}...HEAD`, '--name-only']);
    const filesChanged = diffStat.trim().split('\n').filter(Boolean);

    const log = await this.git.log([`${baseBranch}..HEAD`]);
    const commitCount = log.total;

    return { branchDiff, filesChanged, commitCount, baseBranch };
  }

  async getUncommittedDiff(): Promise<UncommittedDiffResult> {
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
