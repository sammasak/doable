{ pkgs ? import <nixpkgs> {} }:

let
  appBuild = pkgs.runCommand "doable-app" {} ''
    mkdir -p $out/app
    cp -r ${/var/lib/claude-worker/workspace/doable/build} $out/app/build
    cp -r ${/var/lib/claude-worker/workspace/doable/node_modules} $out/app/node_modules
  '';
in
pkgs.dockerTools.buildLayeredImage {
  name = "registry.sammasak.dev/lab/doable-ui";
  tag = "latest";
  contents = [
    pkgs.nodejs_22
    pkgs.cacert
    appBuild
  ];
  config = {
    WorkingDir = "/app";
    Env = [
      "NODE_ENV=production"
      "PORT=3000"
      "HOST=0.0.0.0"
      "SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
    ];
    ExposedPorts = {
      "3000/tcp" = {};
    };
    Cmd = [ "node" "/app/build/index.js" ];
    User = "65534:65534";
  };
}
