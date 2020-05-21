import fs from 'fs';
import glob from 'glob';
import path from 'path';
import * as pb from 'promise-breaker';
import * as promiseTools from 'promise-tools';

const PROJECT_ROOT = path.resolve(__dirname, '../..');

/**
 * Given a glob, find the timestamp of the most recently changed file.
 *
 * @param globToSearch - The glob to search.
 * @param cwd - The current working directory, for glob purposes.  Defaults
 *   to the project's root.
 * @returns time in MS since most recent change.
 */
export async function findMostRecentChange(globToSearch: string, cwd?: string): Promise<number> {
    const files: string[] = await pb.call((done: pb.Callback<string[]>) =>
        glob(globToSearch, { cwd: cwd || PROJECT_ROOT }, done)
    );

    const mTimes = await promiseTools.map(
        files,
        async (file) => {
            const stat = await fs.promises.stat(path.resolve(cwd || PROJECT_ROOT, file));
            return stat.mtimeMs;
        },
        10
    );

    return Math.max(0, ...mTimes);
}
