# Secret Providers

This document explains the secret provider architecture and how to add new providers.

## Overview

Zerobyte supports multiple secret sources through a provider-based architecture:

| Provider | URI Format | Description |
|----------|------------|-------------|
| Environment | `env://VAR_NAME` | Reads `ENV_VAR_NAME` from environment |
| File | `file://name` | Reads `/run/secrets/name` (Docker secrets) |
| 1Password Connect | `op://vault/item/field` | Fetches from 1Password Connect API |
| HashiCorp Vault | `vault://path/to/secret:key` | Fetches from HashiCorp Vault KV v2 |
| Native Encryption | `encv1:...` | Encrypted secrets stored in database |

## Architecture

```text
app/
├── schemas/
│   └── secrets.ts                    # Shared schemas, types, and provider metadata (CLIENT + SERVER)
│
└── server/
    ├── secrets/
    │   ├── types.ts                  # Core interfaces (SecretProvider, BrowsableSecretProvider)
    │   ├── utils.ts                  # Utility functions (parsing, masking)
    │   ├── resolver.ts               # SecretResolver singleton
    │   ├── index.ts                  # Main exports
    │   └── providers/
    │       ├── base.ts               # BaseSecretProvider abstract class
    │       ├── env.ts                # EnvSecretProvider (built-in)
    │       ├── file.ts               # FileSecretProvider (built-in)
    │       ├── onepassword.ts        # OnePasswordConnectProvider
    │       └── vault.ts              # HashiCorpVaultProvider
    │
    ├── db/
    │   └── schema-secret-providers.ts  # Database schema for secret providers
    │
    └── modules/secret-providers/
        ├── provider-registry.ts      # Factory for creating provider instances
        ├── secret-providers.service.ts
        ├── secret-providers.controller.ts
        └── secret-providers.dto.ts   # Re-exports from ~/schemas/secrets
```

## Adding a New Provider

Adding a new provider requires changes to these files:

### 1. Shared Schema (`app/schemas/secrets.ts`)

This is the **central configuration hub** for all provider metadata.

```typescript
// 1. Add ArkType config schema
export const myProviderConfigSchema = type({
  type: "'my-provider'",
  serverUrl: "string",
  apiKey: "string",
  "optionalField?": "string",
});

// 2. Add to union
export const secretProviderConfigSchema = onePasswordConnectConfigSchema
  .or(hashiCorpVaultConfigSchema)
  .or(myProviderConfigSchema);

// 3. Add update schema (secrets optional to keep existing)
export const updateMyProviderConfigSchema = type({
  type: "'my-provider'",
  serverUrl: "string",
  "apiKey?": "string",
  "optionalField?": "string",
});

// 4. Add to update union
export const updateSecretProviderConfigSchema = updateOnePasswordConnectConfigSchema
  .or(updateHashiCorpVaultConfigSchema)
  .or(updateMyProviderConfigSchema);

// 5. Add to SECRET_PROVIDER_TYPES
export const SECRET_PROVIDER_TYPES = {
  "op-connect": "op-connect",
  "hc-vault": "hc-vault",
  "my-provider": "my-provider",  // Add here
} as const;

// 6. Add metadata with field configuration
export const SECRET_PROVIDER_METADATA: Record<SecretProviderType, ProviderMetadata> = {
  // ... existing providers ...
  "my-provider": {
    label: "My Provider",
    description: "Description for the provider list",
    defaultPrefix: "myprov",
    uriExample: "prefix://path/to/secret",
    buildConfig: (values) => ({
      type: "my-provider" as const,
      serverUrl: values.serverUrl as string,
      apiKey: values.apiKey as string,
      optionalField: (values.optionalField as string) || undefined,
    }),
    fields: [
      {
        name: "serverUrl",
        label: "Server URL",
        type: "url",
        placeholder: "https://my-provider.example.com",
        helpText: "The URL of your server",
        required: true,
      },
      {
        name: "apiKey",
        label: "API Key",
        type: "secret",  // Shows SecretInput component with browse
        placeholder: "your-api-key",
        editPlaceholder: "••••••••••••••••••••••••",
        helpText: "API key for authentication. Supports env:// or file:// references.",
        editHelpText: "Leave empty to keep current key",
        required: true,
      },
      {
        name: "optionalField",
        label: "Optional Field",
        type: "text",
        placeholder: "optional value",
        helpText: "An optional configuration field",
      },
    ],
  },
};
```

**Field types:**
- `url` - URL input with validation
- `text` - Plain text input
- `secret` - Password input with SecretInput component (supports browse, env://, file://)
- `switch` - Boolean toggle

### 2. Database Schema (`app/server/db/schema-secret-providers.ts`)

Add the database config type:

```typescript
// Add config type
export type MyProviderDbConfig = {
  type: "my-provider";
  serverUrl: string;
  apiKey: string;  // Will be encrypted before storage
  optionalField?: string;
};

// Update union type
export type SecretProviderDbConfig =
  | OnePasswordConnectDbConfig
  | HashiCorpVaultDbConfig
  | MyProviderDbConfig;
```

### 3. Provider Class (`app/server/secrets/providers/myprovider.ts`)

Create the provider implementation:

```typescript
import type { SecretBrowserNode, BrowsableSecretProvider } from "../types";
import { BaseSecretProvider } from "./base";

export interface MyProviderConfig {
  serverUrl: string;
  apiKey: string;
  optionalField?: string;
}

export class MySecretProvider extends BaseSecretProvider implements BrowsableSecretProvider {
  readonly scheme: string;
  readonly name = "My Provider";

  private readonly config: MyProviderConfig;

  constructor(config: MyProviderConfig, customPrefix?: string) {
    super();
    this.scheme = customPrefix || "myprov";
    this.config = config;
  }

  async get(ref: string): Promise<string> {
    // Parse ref format: myprov://path/to/secret
    const match = ref.match(/^[^:]+:\/\/(.+)$/);
    if (!match) throw new Error(`Invalid reference: ${ref}`);
    
    const path = match[1];
    this.log(`Fetching secret: ${path}`);
    
    // Implement your API call
    const response = await fetch(`${this.config.serverUrl}/secrets/${path}`, {
      headers: { Authorization: `Bearer ${this.config.apiKey}` },
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch secret: ${response.statusText}`);
    }
    
    const data = await response.json();
    return data.value;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.serverUrl}/health`, {
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async browse(path?: string): Promise<SecretBrowserNode[]> {
    // Implement browsing for the secret browser UI
    const response = await fetch(
      `${this.config.serverUrl}/list${path ? `?path=${encodeURIComponent(path)}` : ""}`,
      { headers: { Authorization: `Bearer ${this.config.apiKey}` } },
    );
    
    const items = await response.json();
    
    return items.map((item: { id: string; name: string; isFolder: boolean }) => ({
      id: item.id,
      name: item.name,
      type: item.isFolder ? "folder" as const : "field" as const,
      hasChildren: item.isFolder,
      uri: item.isFolder ? undefined : `${this.scheme}://${path ? `${path}/` : ""}${item.id}`,
    }));
  }
}
```

Export from `providers/index.ts`:

```typescript
export { MySecretProvider } from "./myprovider";
```

### 4. Provider Registry (`app/server/modules/secret-providers/provider-registry.ts`)

Register the factory:

```typescript
import { MySecretProvider } from "../../secrets/providers/myprovider";

const PROVIDER_FACTORIES: Record<SecretProviderType, ProviderFactory> = {
  // ... existing providers ...
  "my-provider": (config, customPrefix) =>
    new MySecretProvider(
      {
        serverUrl: config.serverUrl as string,
        apiKey: config.apiKey as string,
        optionalField: config.optionalField as string | undefined,
      },
      customPrefix,
    ),
};
```

### 5. Generate Migration & API Client

```bash
# Generate database migration
bun gen:migrations

# Regenerate TypeScript API client
bun run gen:api-client
```

## What's Automatic

Thanks to the dynamic architecture, these files **do NOT need changes** when adding a new provider:

- ✅ `create-secret-provider-form.tsx` - Reads fields from `SECRET_PROVIDER_METADATA`
- ✅ `create-secret-provider.tsx` - Uses `buildConfig()` from metadata
- ✅ `secret-provider-details.tsx` - Uses `buildConfig()` and field metadata
- ✅ `secret-providers.service.ts` - Dynamic encryption/decryption based on field types
- ✅ `secret-providers.dto.ts` - Re-exports from shared schema
- ✅ `secret-providers.controller.ts` - Uses shared schema types

## Files to Update Summary

| File | What to add |
|------|-------------|
| `app/schemas/secrets.ts` | Config schemas, types, metadata with fields and `buildConfig` |
| `app/server/db/schema-secret-providers.ts` | Database config type |
| `app/server/secrets/providers/myprovider.ts` | Provider class implementation |
| `app/server/secrets/providers/index.ts` | Export the provider |
| `app/server/modules/secret-providers/provider-registry.ts` | Factory function |

## Secret Resolution Flow

```text
Input Value
    │
    ├─ encv1:... → Decrypt with cryptoUtils → Return plaintext
    │
    ├─ scheme://... → Find provider by scheme → Call provider.get() → Return value
    │   ├─ op://vault/item/field → OnePasswordConnectProvider
    │   ├─ vault://path:key → HashiCorpVaultProvider
    │   ├─ env://VAR → EnvSecretProvider
    │   └─ file://name → FileSecretProvider
    │
    └─ (no scheme) → Return as-is (plaintext)
```

## Security Considerations

1. **Bootstrap Secrets**: Provider credentials can use `env://` or `file://` references to avoid storing tokens encrypted in the database.

2. **Secret References**: Values starting with `env://`, `file://`, etc. are stored as-is (not encrypted) since they're references, not actual secrets.

3. **Native Encryption**: Only raw values are encrypted with `encv1:` prefix before database storage.

4. **Field Type "secret"**: Fields with `type: "secret"` in metadata are automatically encrypted/decrypted by the service.

5. **Config Summary**: API responses only include non-sensitive fields (URLs, flags) - never tokens or keys.
