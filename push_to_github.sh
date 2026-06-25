#!/bin/bash

# Exit on error
set -e

echo "=== Git Push Automation Helper ==="
echo "This script stages, commits, and pushes all files in this folder to your GitHub repository."
echo ""

# Check if git is installed
if ! command -v git &> /dev/null; then
    echo "❌ Error: git is not installed on your system. Please install it first (e.g., sudo apt install git)."
    exit 1
fi

# Check if directory is a git repository
if [ ! -d .git ]; then
    echo "⚠️ This directory is not currently initialized as a Git repository."
    read -p "Would you like to initialize it and link it to GitHub? (y/n): " init_choice
    if [[ "$init_choice" =~ ^[Yy]$ ]]; then
        git init
        
        # Ask for GitHub Repository URL
        read -p "Enter your GitHub Repository URL (e.g., https://github.com/username/repo-name.git): " repo_url
        if [ -z "$repo_url" ]; then
            echo "❌ Error: Repository URL cannot be empty."
            exit 1
        fi
        
        git remote add origin "$repo_url"
        
        # Set default branch to main
        git branch -M main
        echo "✅ Initialized Git repository and set remote origin to: $repo_url"
    else
        echo "❌ Aborting. You must run this inside a Git repository."
        exit 1
    fi
fi

# Stage all files
echo "📦 Staging all files..."
git add -A

# Display status of files to be committed
echo "🔍 Current Git status:"
git status --short

# Ask user for a custom commit message or use a default one
read -p "Enter commit message [or press Enter for: 'Update review network codebase: fix mobile layouts and button syntax']: " commit_msg
if [ -z "$commit_msg" ]; then
    commit_msg="Update review network codebase: fix mobile layouts and button syntax"
fi

# Commit changes
if [ -n "$(git status --porcelain)" ]; then
    echo "💾 Committing changes..."
    git commit -m "$commit_msg"
else
    echo "ℹ️ No new changes to commit, proceeding to push."
fi

# Determine current branch
current_branch=$(git branch --show-current)
if [ -z "$current_branch" ]; then
    current_branch="main"
fi

# Push changes
echo "🚀 Pushing changes to GitHub (branch: $current_branch)..."
echo "Note: If this is the first push, we will set the upstream branch."

if git ls-remote --exit-code --heads origin "$current_branch" &>/dev/null; then
    git push origin "$current_branch"
else
    git push -u origin "$current_branch"
fi

echo ""
echo "🎉 Successfully synchronized all updates to GitHub!"
echo "Check your repository online to verify."
