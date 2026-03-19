/**
 * Navigation layer — page hierarchy, link graph, label topology.
 * See ADR-400: Graph-Native Page Navigation.
 *
 * Initial implementation uses REST v2. GraphQL adapter for deep
 * traversals (tree, backlinks) will be added per ADR-200.
 */

export { NavigationService } from './navigation-service.js';
