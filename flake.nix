{
  description = "Zerobyte - Self-hosted backup automation and management";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    bun2nix.url = "github:nix-community/bun2nix";
    bun2nix.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = { self, nixpkgs, flake-utils, bun2nix }:
    let
      # Systems for packages and devShells
      allSystems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];

      # Linux-only systems for NixOS module and tests
      linuxSystems = [
        "x86_64-linux"
        "aarch64-linux"
      ];

      # shoutrrr version and hashes (SRI format)
      shoutrrrVersion = "0.13.1";
      shoutrrrHashes = {
        x86_64-linux = "sha256-TZrDstm5InQOalYf9da5rhnsJm7qTnmG18jLJtvsD8A=";
        aarch64-linux = "sha256-IHgZhsykJbmW/uYUsd6o7Wh3EIsUldduIKFZ0GkjrwI=";
        x86_64-darwin = "sha256-pzmAGRzbWYVHoZqvx6tsuxpuKcfIXMVNPXbKHeeAyxs=";
        aarch64-darwin = "sha256-DKQRzdDd1xccNqetscEKKzgyT1IatOlwPBwa4E8fbDc=";
      };

      # Map Nix system to shoutrrr release naming
      shoutrrrArch = {
        x86_64-linux = "linux_amd64";
        aarch64-linux = "linux_arm64v8";
        x86_64-darwin = "macOS_amd64";
        aarch64-darwin = "macOS_arm64v8";
      };

      # Check if system is Linux
      isLinux = system: builtins.elem system linuxSystems;

    in
    flake-utils.lib.eachSystem allSystems (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          config.allowUnfree = true;
          overlays = [ bun2nix.overlays.default ];
        };

        shoutrrr = pkgs.stdenv.mkDerivation {
          pname = "shoutrrr";
          version = shoutrrrVersion;

          src = pkgs.fetchurl {
            url = "https://github.com/nicholas-fedor/shoutrrr/releases/download/v${shoutrrrVersion}/shoutrrr_${shoutrrrArch.${system}}_${shoutrrrVersion}.tar.gz";
            hash = shoutrrrHashes.${system};
          };

          sourceRoot = ".";

          nativeBuildInputs = pkgs.lib.optionals (isLinux system) [ pkgs.autoPatchelfHook ];

          installPhase = ''
            runHook preInstall
            install -Dm755 shoutrrr $out/bin/shoutrrr
            runHook postInstall
          '';

          meta = with pkgs.lib; {
            description = "Notification library and CLI for various services";
            homepage = "https://github.com/nicholas-fedor/shoutrrr";
            license = licenses.mit;
            platforms = platforms.unix;
          };
        };

        # Read version from package.json to avoid drift
        packageJson = builtins.fromJSON (builtins.readFile ./package.json);

        zerobyte = pkgs.stdenv.mkDerivation {
          pname = "zerobyte";
          version = packageJson.version or "0.0.0";

          src = pkgs.lib.cleanSource ./.;

          nativeBuildInputs = [
            pkgs.bun2nix.hook
            pkgs.makeWrapper
          ];

          # Fetch bun dependencies using bun2nix
          bunDeps = pkgs.bun2nix.fetchBunDeps {
            bunNix = ./bun.nix;
          };

          buildPhase = ''
            runHook preBuild

            export HOME=$(mktemp -d)

            # Build the application (react-router build)
            bun run build

            runHook postBuild
          '';

          installPhase = ''
            runHook preInstall

            # Create output directories matching the expected structure
            mkdir -p $out/lib/zerobyte/dist
            mkdir -p $out/lib/zerobyte/drizzle
            mkdir -p $out/bin

            # Copy built assets (server expects dist/server and dist/client)
            cp -r dist/server $out/lib/zerobyte/dist/server
            cp -r dist/client $out/lib/zerobyte/dist/client
            cp -r app/drizzle/* $out/lib/zerobyte/drizzle/
            cp package.json $out/lib/zerobyte/

            # Copy node_modules for runtime dependencies
            cp -r node_modules $out/lib/zerobyte/

            # Create wrapper script with runtime dependencies
            # --chdir ensures server finds dist/client relative to package dir
            makeWrapper ${pkgs.bun}/bin/bun $out/bin/zerobyte \
              --chdir $out/lib/zerobyte \
              --add-flags "dist/server/index.js" \
              --prefix PATH : ${pkgs.lib.makeBinPath ([
                pkgs.restic
                pkgs.rclone
                shoutrrr
                pkgs.openssh
              ] ++ pkgs.lib.optionals (isLinux system) [
                pkgs.fuse3
                pkgs.davfs2
              ])} \
              --set NODE_ENV "production"

            runHook postInstall
          '';

          meta = with pkgs.lib; {
            description = "Self-hosted backup automation and management";
            homepage = "https://github.com/nicotsx/zerobyte";
            license = licenses.mit;
            platforms = platforms.unix;
            mainProgram = "zerobyte";
          };
        };

      in
      {
        packages = {
          inherit zerobyte shoutrrr;
          default = zerobyte;
        };

        devShells.default = pkgs.mkShell {
          buildInputs = [
            # JavaScript runtime and package manager
            pkgs.bun
            pkgs.nodejs

            # Development tools
            pkgs.biome
            pkgs.typescript

            # bun2nix CLI for regenerating bun.nix
            bun2nix.packages.${system}.bun2nix

            # External tools (for local testing)
            pkgs.restic
            pkgs.rclone
            shoutrrr

            # Database tools
            pkgs.sqlite

            # Utilities
            pkgs.git
            pkgs.curl
            pkgs.jq
          ];

          shellHook = ''
            echo "Zerobyte development environment"
            echo "  bun:      $(bun --version)"
            echo "  node:     $(node --version)"
            echo "  restic:   $(restic version | head -1)"
            echo "  rclone:   $(rclone version | head -1)"
            echo ""
            echo "To update bun.nix after changing dependencies:"
            echo "  bun2nix -o bun.nix"
          '';
        };
      }
    ) // {
      # Overlay
      overlays.default = final: prev: {
        zerobyte = self.packages.${final.system}.zerobyte;
        shoutrrr = self.packages.${final.system}.shoutrrr;
      };

      # NixOS Module
      nixosModules.default = { config, lib, pkgs, ... }:
        let
          cfg = config.services.zerobyte;
        in
        {
          options.services.zerobyte = {
            enable = lib.mkEnableOption "Zerobyte backup management service";

            package = lib.mkOption {
              type = lib.types.package;
              default = self.packages.${pkgs.system}.zerobyte;
              defaultText = lib.literalExpression "pkgs.zerobyte";
              description = "The Zerobyte package to use.";
            };

            user = lib.mkOption {
              type = lib.types.str;
              default = "zerobyte";
              description = "User account under which Zerobyte runs.";
            };

            group = lib.mkOption {
              type = lib.types.str;
              default = "zerobyte";
              description = "Group under which Zerobyte runs.";
            };

            createUser = lib.mkOption {
              type = lib.types.bool;
              default = true;
              description = ''
                Whether to create the user and group automatically.
                Set to false if using an existing user account.
              '';
            };

            dataDir = lib.mkOption {
              type = lib.types.path;
              default = "/var/lib/zerobyte";
              description = "Directory to store Zerobyte data.";
            };

            port = lib.mkOption {
              type = lib.types.port;
              default = 4096;
              description = "Port on which Zerobyte listens.";
            };

            openFirewall = lib.mkOption {
              type = lib.types.bool;
              default = false;
              description = "Whether to open the firewall for Zerobyte.";
            };

            serverIp = lib.mkOption {
              type = lib.types.str;
              default = "0.0.0.0";
              description = "IP address to bind the server to.";
            };

            timezone = lib.mkOption {
              type = lib.types.str;
              default = "UTC";
              description = "Timezone for scheduling backups.";
            };

            resticHostname = lib.mkOption {
              type = lib.types.str;
              default = "zerobyte";
              description = "Hostname used for restic operations.";
            };

            environment = lib.mkOption {
              type = lib.types.attrsOf lib.types.str;
              default = {};
              description = "Additional environment variables for Zerobyte.";
            };

            fuse = {
              enable = lib.mkOption {
                type = lib.types.bool;
                default = true;
                description = ''
                  Enable FUSE mounting capabilities.
                  Requires CAP_SYS_ADMIN and access to /dev/fuse.
                  Enables NFS, SMB, and WebDAV volume mounts.
                '';
              };
            };

            protectHome = lib.mkOption {
              type = lib.types.bool;
              default = true;
              description = ''
                Enable ProtectHome systemd security hardening.
                When true, /home, /root, and /run/user are inaccessible.
                Set to false if you need to backup home directories.
              '';
            };

            extraReadWritePaths = lib.mkOption {
              type = lib.types.listOf lib.types.str;
              default = [];
              example = [ "/mnt/storage" "/backup" ];
              description = ''
                Additional paths the service can write to.
                Use this for custom repository locations outside of dataDir.
                Required because ProtectSystem=strict makes the filesystem read-only.
              '';
            };
          };

          config = lib.mkIf cfg.enable {
            users.users.${cfg.user} = lib.mkIf cfg.createUser {
              isSystemUser = true;
              group = cfg.group;
              home = cfg.dataDir;
              createHome = true;
              description = "Zerobyte service user";
            };

            users.groups.${cfg.group} = lib.mkIf cfg.createUser {};

            systemd.services.zerobyte = {
              description = "Zerobyte backup management service";
              wantedBy = [ "multi-user.target" ];
              after = [ "network.target" ];

              environment = {
                NODE_ENV = "production";
                PORT = toString cfg.port;
                SERVER_IP = cfg.serverIp;
                RESTIC_HOSTNAME = cfg.resticHostname;
                DATABASE_URL = "${cfg.dataDir}/data/zerobyte.db";
                MIGRATIONS_PATH = "${cfg.package}/lib/zerobyte/drizzle";
                TZ = cfg.timezone;
              } // cfg.environment;

              serviceConfig = {
                Type = "simple";
                User = cfg.user;
                Group = cfg.group;
                ExecStart = "${cfg.package}/bin/zerobyte";
                Restart = "on-failure";
                RestartSec = 5;

                # State directory
                StateDirectory = "zerobyte";
                StateDirectoryMode = "0750";
                WorkingDirectory = cfg.dataDir;

                # Capabilities
                # - CAP_SYS_ADMIN: Required for FUSE mounts
                # - CAP_DAC_READ_SEARCH: Required to read restricted directories (e.g., 700 home dirs)
                # - CAP_DAC_OVERRIDE: Required to write to directories not owned by service user
                AmbientCapabilities =
                  lib.optional cfg.fuse.enable "CAP_SYS_ADMIN"
                  ++ lib.optional (!cfg.protectHome) "CAP_DAC_READ_SEARCH"
                  ++ lib.optional (cfg.extraReadWritePaths != []) "CAP_DAC_OVERRIDE";
                CapabilityBoundingSet =
                  lib.optional cfg.fuse.enable "CAP_SYS_ADMIN"
                  ++ lib.optional (!cfg.protectHome) "CAP_DAC_READ_SEARCH"
                  ++ lib.optional (cfg.extraReadWritePaths != []) "CAP_DAC_OVERRIDE";
                DeviceAllow = lib.mkIf cfg.fuse.enable [ "/dev/fuse rw" ];

                # Security hardening
                PrivateTmp = true;
                ProtectSystem = "strict";
                ProtectHome = cfg.protectHome;
                # Disable when capabilities are needed (FUSE, home access, or extra write paths)
                NoNewPrivileges = !cfg.fuse.enable && cfg.protectHome && cfg.extraReadWritePaths == [];
                ProtectKernelTunables = true;
                ProtectKernelModules = true;
                ProtectControlGroups = true;
                RestrictAddressFamilies = [ "AF_UNIX" "AF_INET" "AF_INET6" ];
                RestrictNamespaces = !cfg.fuse.enable;
                LockPersonality = true;
                MemoryDenyWriteExecute = false; # Required for bun/V8
                RestrictRealtime = true;
                RestrictSUIDSGID = true;
                RemoveIPC = true;
                PrivateMounts = !cfg.fuse.enable;

                # Allow write access to data directory
                ReadWritePaths = [ cfg.dataDir ] ++ cfg.extraReadWritePaths;
              };
            };

            networking.firewall.allowedTCPPorts = lib.mkIf cfg.openFirewall [ cfg.port ];
          };
        };

      # nix-darwin Module (macOS) - EXPERIMENTAL/FUTURE USE
      # macOS lacks Linux capabilities (CAP_DAC_READ_SEARCH, etc.) and uses TCC
      # (Transparency, Consent, and Control) which blocks access to ~/Desktop,
      # ~/Documents, etc. even for root. Full support requires significant code
      # changes to handle TCC permission grants via System Preferences.
      darwinModules.default = { config, lib, pkgs, ... }:
        let
          cfg = config.services.zerobyte;
        in
        {
          options.services.zerobyte = {
            enable = lib.mkEnableOption "Zerobyte backup management service";

            package = lib.mkOption {
              type = lib.types.package;
              default = self.packages.${pkgs.system}.zerobyte;
              defaultText = lib.literalExpression "pkgs.zerobyte";
              description = "The Zerobyte package to use.";
            };

            dataDir = lib.mkOption {
              type = lib.types.path;
              default = "/var/lib/zerobyte";
              description = "Directory to store Zerobyte data.";
            };

            port = lib.mkOption {
              type = lib.types.port;
              default = 4096;
              description = "Port on which Zerobyte listens.";
            };

            serverIp = lib.mkOption {
              type = lib.types.str;
              default = "0.0.0.0";
              description = "IP address to bind the server to.";
            };

            timezone = lib.mkOption {
              type = lib.types.str;
              default = "UTC";
              description = "Timezone for scheduling backups.";
            };

            resticHostname = lib.mkOption {
              type = lib.types.str;
              default = "zerobyte";
              description = "Hostname used for restic operations.";
            };

            environment = lib.mkOption {
              type = lib.types.attrsOf lib.types.str;
              default = {};
              description = "Additional environment variables for Zerobyte.";
            };
          };

          config = lib.mkIf cfg.enable {
            # Create data directory
            system.activationScripts.zerobyte.text = ''
              mkdir -p ${cfg.dataDir}/data
              chmod 750 ${cfg.dataDir}
            '';

            launchd.daemons.zerobyte = {
              serviceConfig = {
                Label = "org.zerobyte.daemon";
                ProgramArguments = [ "${cfg.package}/bin/zerobyte" ];
                RunAtLoad = true;
                KeepAlive = true;
                WorkingDirectory = "${cfg.dataDir}";

                EnvironmentVariables = {
                  NODE_ENV = "production";
                  PORT = toString cfg.port;
                  SERVER_IP = cfg.serverIp;
                  RESTIC_HOSTNAME = cfg.resticHostname;
                  DATABASE_URL = "${cfg.dataDir}/data/zerobyte.db";
                  MIGRATIONS_PATH = "${cfg.package}/lib/zerobyte/drizzle";
                  TZ = cfg.timezone;
                } // cfg.environment;

                StandardOutPath = "/var/log/zerobyte.log";
                StandardErrorPath = "/var/log/zerobyte.error.log";
              };
            };
          };
        };

      # NixOS VM Tests (Linux only)
      checks = builtins.listToAttrs (map (system:
        let
          pkgs = import nixpkgs { inherit system; };
        in
        {
          name = system;
          value = {
            integration = pkgs.testers.nixosTest {
              name = "zerobyte-integration";

              nodes.machine = { config, pkgs, ... }: {
                imports = [ self.nixosModules.default ];

                services.zerobyte = {
                  enable = true;
                  openFirewall = true;
                };

                # Ensure the test VM has enough resources
                virtualisation = {
                  memorySize = 1024;
                  diskSize = 2048;
                };
              };

              testScript = ''
                machine.start()
                machine.wait_for_unit("zerobyte.service")
                machine.wait_for_open_port(4096)

                # Test healthcheck endpoint (returns {"status":"ok"})
                result = machine.succeed("curl -s http://localhost:4096/healthcheck")
                assert '"status":"ok"' in result or '"ok"' in result, f"Healthcheck failed: {result}"

                machine.log("Zerobyte integration test passed!")
              '';
            };
          };
        }
      ) linuxSystems);
    };
}
