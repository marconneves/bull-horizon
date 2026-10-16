import { gql } from 'graphql-request';

/** Everything the run view draws. Fields cut at `basic` detail come back null. */
export const AGENT_RUN_FIELDS_FRAG = gql`
  fragment AgentRunFields on AgentRun {
    v
    detail
    detailMismatch
    source
    model
    attempt
    startedAt
    finishedAt
    durationMs
    inputTokens
    outputTokens
    finishReason
    outcome
    cost
    overheadStartMs
    overheadEndMs
    truncated
    error
    input {
      conversationId
      text
    }
    final {
      text
      cards {
        type
        title
      }
    }
    steps {
      step
      startedAt
      durationMs
      finishReason
      inputTokens
      outputTokens
      cost
      text
      tools {
        name
        ok
        durationMs
        summary
        empty
        startedAt
        outputChars
        input
        output
        error
      }
    }
  }
`;
