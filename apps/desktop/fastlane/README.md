fastlane documentation
----

# Installation

Make sure you have the latest version of the Xcode command line tools installed:

```sh
xcode-select --install
```

For _fastlane_ installation instructions, see [Installing _fastlane_](https://docs.fastlane.tools/#installing-fastlane)

# Available Actions

## Mac

### mac build_mas

```sh
[bundle exec] fastlane mac build_mas
```

Build the signed Mac App Store package

### mac upload_testflight

```sh
[bundle exec] fastlane mac upload_testflight
```

Upload the latest signed Mac App Store package to App Store Connect

### mac beta

```sh
[bundle exec] fastlane mac beta
```

Build and upload the Mac App Store package to App Store Connect

----

This README.md is auto-generated and will be re-generated every time [_fastlane_](https://fastlane.tools) is run.

More information about _fastlane_ can be found on [fastlane.tools](https://fastlane.tools).

The documentation of _fastlane_ can be found on [docs.fastlane.tools](https://docs.fastlane.tools).
