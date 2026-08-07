import type { PromoteJobsMutation } from '@/typings/gql';

export const promoteJobsMock = (): Promise<PromoteJobsMutation> => {
  return Promise.resolve({
    promoteJobs: [],
  });
};
