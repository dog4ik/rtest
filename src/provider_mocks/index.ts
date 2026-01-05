import type { MockProviderParams } from "@/mock_server/api";

/**
 * Minimal interface that must be impelmented by all providers
 **/
export interface AnyProvider {
  settings(key: string): {};
  mock_params(key: string): MockProviderParams;
}

// export function createAnyProvider<S>(params: {
//   settings: (unique_key: string) => S;
//   mock_params: (settings: S) => MockProviderParams;
// }){
//   return {
//     mock_params: (settings) => params.mock_params(settings),
//     settings: params.settings,
//   };
// }

// createAnyProvider({
//   settings: { foo: "bar" },
//   mock_params: (settings) => ({}),
// });
